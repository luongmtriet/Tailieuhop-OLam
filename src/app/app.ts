import { ChangeDetectionStrategy, Component, signal, inject, OnInit, computed, OnDestroy } from '@angular/core';
import { CommonModule, NgTemplateOutlet } from '@angular/common';
import { FormsModule, ReactiveFormsModule, FormBuilder, Validators } from '@angular/forms';
import { MatIconModule } from '@angular/material/icon';
import { SafeUrlPipe } from './safe-url.pipe';
import { 
  collection, 
  onSnapshot, 
  addDoc, 
  updateDoc, 
  deleteDoc, 
  doc, 
  query, 
  orderBy, 
  serverTimestamp,
  getDocFromServer,
  Timestamp
} from 'firebase/firestore';
import { 
  signInWithPopup, 
  GoogleAuthProvider, 
  onAuthStateChanged, 
  signOut,
  User
} from 'firebase/auth';
import { db, auth, OperationType, handleFirestoreError } from './firebase';

interface MeetingDoc {
  name: string;
  url: string;
}

interface Meeting {
  id: string;
  title: string;
  date: string;
  time?: string;
  docs: MeetingDoc[];
  description: string;
  createdAt?: Timestamp;
  updatedAt?: Timestamp;
}

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [CommonModule, FormsModule, ReactiveFormsModule, MatIconModule, SafeUrlPipe, NgTemplateOutlet],
  templateUrl: './app.html',
  styleUrl: './app.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class App implements OnInit, OnDestroy {
  private fb = inject(FormBuilder);
  
  meetings = signal<Meeting[]>([]);
  searchTerm = signal<string>('');
  selectedMeeting = signal<Meeting | null>(null);
  selectedDocIndex = signal<number>(0);
  isAddingMeeting = signal(false);
  isEditingMeeting = signal(false);
  editingMeetingId = signal<string | null>(null);
  meetingToDelete = signal<string | null>(null);
  isFullscreen = signal(false);
  
  // Auth State
  currentUser = signal<User | null>(null);
  isAdmin = signal(false);
  isAuthReady = signal(false);
  showAdminLogin = signal(false);
  
  private unsubscribeMeetings?: () => void;
  private unsubscribeAuth?: () => void;

  filteredMeetings = computed(() => {
    const term = this.searchTerm().toLowerCase();
    const all = this.meetings();
    if (!term) return all;
    
    return all.filter(m => 
      m.title.toLowerCase().includes(term) || 
      m.description.toLowerCase().includes(term) ||
      m.docs.some(d => d.name.toLowerCase().includes(term))
    );
  });

  upcomingMeetings = computed(() => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    
    return this.filteredMeetings()
      .filter(m => new Date(m.date) >= today)
      .sort((a, b) => {
        const timeA = this.getFullDate(a.date, a.time);
        const timeB = this.getFullDate(b.date, b.time);
        return timeA - timeB;
      });
  });

  pastMeetings = computed(() => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    
    return this.filteredMeetings()
      .filter(m => new Date(m.date) < today)
      .sort((a, b) => {
        const timeA = this.getFullDate(a.date, a.time);
        const timeB = this.getFullDate(b.date, b.time);
        return timeB - timeA;
      });
  });

  private getFullDate(date: string, time?: string): number {
    const d = new Date(date);
    if (time) {
      const [hours, minutes] = time.split(':').map(Number);
      d.setHours(hours, minutes);
    } else {
      d.setHours(0, 0, 0, 0);
    }
    return d.getTime();
  }

  meetingForm = this.fb.group({
    title: ['', [Validators.required, Validators.minLength(3)]],
    date: ['', Validators.required],
    time: [''],
    description: [''],
    docs: this.fb.array([
      this.fb.group({
        name: ['Tài liệu 1', Validators.required],
        url: ['', [Validators.required, Validators.pattern(/https?:\/\/.+/)]]
      })
    ])
  });

  get docsArray() {
    return this.meetingForm.controls.docs;
  }

  addDocField() {
    this.docsArray.push(this.fb.group({
      name: [`Tài liệu ${this.docsArray.length + 1}`, Validators.required],
      url: ['', [Validators.required, Validators.pattern(/https?:\/\/.+/)]]
    }));
  }

  removeDocField(index: number) {
    if (this.docsArray.length > 1) {
      this.docsArray.removeAt(index);
    }
  }

  ngOnInit() {
    this.testConnection();
    this.initAuth();
    this.loadMeetings();
  }

  ngOnDestroy() {
    if (this.unsubscribeMeetings) this.unsubscribeMeetings();
    if (this.unsubscribeAuth) this.unsubscribeAuth();
  }

  async testConnection() {
    try {
      await getDocFromServer(doc(db, 'test', 'connection'));
    } catch (error) {
      if (error instanceof Error && error.message.includes('the client is offline')) {
        console.error("Please check your Firebase configuration.");
      }
    }
  }

  initAuth() {
    this.unsubscribeAuth = onAuthStateChanged(auth, async (user) => {
      this.currentUser.set(user);
      if (user) {
        // Check if user is admin
        // For simplicity, we'll use the email from the rules or a users collection
        const userDocRef = doc(db, 'users', user.uid);
        try {
          const userSnap = await getDocFromServer(userDocRef);
          if (userSnap.exists() && userSnap.data()['role'] === 'admin') {
            this.isAdmin.set(true);
          } else if (user.email === 'luongmtriet.tltl@gmail.com') {
            this.isAdmin.set(true);
          } else {
            this.isAdmin.set(false);
          }
        } catch {
          // If user doc doesn't exist, check default admin email
          if (user.email === 'luongmtriet.tltl@gmail.com') {
            this.isAdmin.set(true);
          } else {
            this.isAdmin.set(false);
          }
        }
      } else {
        this.isAdmin.set(false);
      }
      this.isAuthReady.set(true);
    });
  }

  async loginAdmin() {
    const provider = new GoogleAuthProvider();
    try {
      await signInWithPopup(auth, provider);
      this.showAdminLogin.set(false);
    } catch (error) {
      console.error('Login failed', error);
      alert('Đăng nhập thất bại!');
    }
  }

  async logoutAdmin() {
    try {
      await signOut(auth);
      this.isAdmin.set(false);
    } catch (error) {
      console.error('Logout failed', error);
    }
  }

  loadMeetings() {
    const meetingsRef = collection(db, 'meetings');
    const q = query(meetingsRef, orderBy('date', 'desc'), orderBy('time', 'desc'));
    
    this.unsubscribeMeetings = onSnapshot(q, (snapshot) => {
      const meetingsData = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      })) as Meeting[];
      this.meetings.set(meetingsData);
    }, (error) => {
      handleFirestoreError(error, OperationType.GET, 'meetings');
    });
  }

  async addMeeting() {
    if (this.meetingForm.valid) {
      const meetingData = {
        title: this.meetingForm.value.title!,
        date: this.meetingForm.value.date!,
        time: this.meetingForm.value.time || '',
        docs: (this.meetingForm.value.docs as MeetingDoc[]) || [],
        description: this.meetingForm.value.description || '',
        updatedAt: serverTimestamp()
      };

      try {
        if (this.isEditingMeeting() && this.editingMeetingId()) {
          const id = this.editingMeetingId()!;
          const meetingRef = doc(db, 'meetings', id);
          await updateDoc(meetingRef, meetingData);
        } else {
          const meetingsRef = collection(db, 'meetings');
          await addDoc(meetingsRef, {
            ...meetingData,
            createdAt: serverTimestamp()
          });
        }
        this.closeMeetingModal();
      } catch (error) {
        handleFirestoreError(error, this.isEditingMeeting() ? OperationType.UPDATE : OperationType.CREATE, 'meetings');
      }
    }
  }

  editMeeting(meeting: Meeting, event: Event) {
    event.stopPropagation();
    this.isEditingMeeting.set(true);
    this.editingMeetingId.set(meeting.id);
    
    // Reset form and populate with meeting data
    this.meetingForm.reset();
    while (this.docsArray.length > 0) {
      this.docsArray.removeAt(0);
    }
    
    this.meetingForm.patchValue({
      title: meeting.title,
      date: meeting.date,
      time: meeting.time || '',
      description: meeting.description
    });

    meeting.docs.forEach(doc => {
      this.docsArray.push(this.fb.group({
        name: [doc.name, Validators.required],
        url: [doc.url, [Validators.required, Validators.pattern(/https?:\/\/.+/)]]
      }));
    });

    this.isAddingMeeting.set(true);
  }

  closeMeetingModal() {
    this.isAddingMeeting.set(false);
    this.isEditingMeeting.set(false);
    this.editingMeetingId.set(null);
    this.resetForm();
  }

  resetForm() {
    this.meetingForm.reset();
    while (this.docsArray.length > 1) {
      this.docsArray.removeAt(0);
    }
    this.docsArray.at(0).patchValue({ name: 'Tài liệu 1', url: '' });
  }

  deleteMeeting(id: string, event: Event) {
    event.stopPropagation();
    this.meetingToDelete.set(id);
  }

  async confirmDelete() {
    const id = this.meetingToDelete();
    if (id === 'all') {
      // Deleting all is complex in Firestore, we'll just delete one by one or skip for now
      // For safety, let's just delete the ones currently in view
      for (const m of this.meetings()) {
        try {
          await deleteDoc(doc(db, 'meetings', m.id));
        } catch (e) {
          console.error('Error deleting meeting', m.id, e);
        }
      }
      this.selectedMeeting.set(null);
      this.meetingToDelete.set(null);
      return;
    }
    if (id) {
      try {
        await deleteDoc(doc(db, 'meetings', id));
        if (this.selectedMeeting()?.id === id) {
          this.selectedMeeting.set(null);
        }
        this.meetingToDelete.set(null);
      } catch (error) {
        handleFirestoreError(error, OperationType.DELETE, `meetings/${id}`);
      }
    }
  }

  deleteAllMeetings() {
    this.meetingToDelete.set('all');
  }

  selectMeeting(meeting: Meeting) {
    this.selectedMeeting.set(meeting);
    this.selectedDocIndex.set(0);
  }

  backToList() {
    this.selectedMeeting.set(null);
    this.selectedDocIndex.set(0);
    this.isFullscreen.set(false);
  }

  toggleFullscreen() {
    this.isFullscreen.update(v => !v);
  }

  getEmbedUrl(url: string): string {
    if (!url) return '';
    
    // Handle Google Drive links
    if (url.includes('drive.google.com')) {
      // If it's a sharing link with /view
      if (url.includes('/view')) {
        return url.split('/view')[0] + '/preview';
      }
      // If it's a link with id=
      if (url.includes('id=')) {
        const match = url.match(/id=([^&]+)/);
        if (match && match[1]) {
          return `https://drive.google.com/file/d/${match[1]}/preview`;
        }
      }
      // If it's a direct file link /file/d/ID
      if (url.includes('/file/d/')) {
        const parts = url.split('/file/d/');
        const id = parts[1].split('/')[0];
        return `https://drive.google.com/file/d/${id}/preview`;
      }
    }

    // Handle Google Docs/Sheets/Slides direct links
    if (url.includes('docs.google.com')) {
      if (url.includes('/edit')) {
        return url.split('/edit')[0] + '/preview';
      }
    }

    return url;
  }

  openInNewTab(url: string) {
    window.open(url, '_blank');
  }
}

import { ChangeDetectionStrategy, Component, signal, inject, OnInit, computed } from '@angular/core';
import { CommonModule, NgTemplateOutlet } from '@angular/common';
import { FormsModule, ReactiveFormsModule, FormBuilder, Validators } from '@angular/forms';
import { MatIconModule } from '@angular/material/icon';
import { SafeUrlPipe } from './safe-url.pipe';

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
}

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [CommonModule, FormsModule, ReactiveFormsModule, MatIconModule, SafeUrlPipe, NgTemplateOutlet],
  templateUrl: './app.html',
  styleUrl: './app.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class App implements OnInit {
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
  
  // Admin Mode State
  isAdmin = signal(false);
  showAdminLogin = signal(false);
  adminPassword = signal('');
  private readonly ADMIN_KEY = 'admin123'; // Default key

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
    this.loadMeetings();
    this.checkAdminSession();
  }

  checkAdminSession() {
    if (typeof window === 'undefined') return;
    const session = localStorage.getItem('meeting_hub_admin');
    if (session === 'true') {
      this.isAdmin.set(true);
    }
  }

  loginAdmin() {
    if (this.adminPassword() === this.ADMIN_KEY) {
      this.isAdmin.set(true);
      if (typeof window !== 'undefined') {
        localStorage.setItem('meeting_hub_admin', 'true');
      }
      this.showAdminLogin.set(false);
      this.adminPassword.set('');
    } else {
      alert('Mật khẩu quản trị không đúng!');
    }
  }

  logoutAdmin() {
    this.isAdmin.set(false);
    if (typeof window !== 'undefined') {
      localStorage.removeItem('meeting_hub_admin');
    }
  }

  loadMeetings() {
    if (typeof window === 'undefined') return;
    const saved = localStorage.getItem('meeting_hub_data');
    if (saved) {
      try {
        const data = JSON.parse(saved);
        // Migration for old data format
        const migrated = data.map((m: { docUrl?: string; docs?: MeetingDoc[] } & Partial<Meeting>) => {
          if (m.docUrl && !m.docs) {
            return {
              ...m,
              docs: [{ name: 'Tài liệu gốc', url: m.docUrl }]
            };
          }
          return m;
        });
        this.meetings.set(migrated);
      } catch (e) {
        console.error('Error parsing saved meetings', e);
      }
    }
  }

  saveMeetings() {
    if (typeof window === 'undefined') return;
    localStorage.setItem('meeting_hub_data', JSON.stringify(this.meetings()));
  }

  addMeeting() {
    if (this.meetingForm.valid) {
      const meetingData = {
        title: this.meetingForm.value.title!,
        date: this.meetingForm.value.date!,
        time: this.meetingForm.value.time || '',
        docs: (this.meetingForm.value.docs as MeetingDoc[]) || [],
        description: this.meetingForm.value.description || ''
      };

      if (this.isEditingMeeting() && this.editingMeetingId()) {
        const id = this.editingMeetingId()!;
        this.meetings.update(prev => prev.map(m => m.id === id ? { ...m, ...meetingData } : m));
        
        // Update selected meeting if it's the one being edited
        if (this.selectedMeeting()?.id === id) {
          this.selectedMeeting.set({ id, ...meetingData });
        }
      } else {
        const newMeeting: Meeting = {
          id: Date.now().toString(),
          ...meetingData
        };
        this.meetings.update(prev => [newMeeting, ...prev]);
      }

      this.saveMeetings();
      this.closeMeetingModal();
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

  confirmDelete() {
    const id = this.meetingToDelete();
    if (id === 'all') {
      this.meetings.set([]);
      this.saveMeetings();
      this.selectedMeeting.set(null);
      this.meetingToDelete.set(null);
      return;
    }
    if (id) {
      this.meetings.update(prev => prev.filter(m => m.id !== id));
      this.saveMeetings();
      if (this.selectedMeeting()?.id === id) {
        this.selectedMeeting.set(null);
      }
      this.meetingToDelete.set(null);
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
